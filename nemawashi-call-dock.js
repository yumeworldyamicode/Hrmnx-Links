/*
 * NEMAWASHI SHARED MUSIC CALL DOCK V4.3
 *
 * Include this small file on KiKi, Serashio, Hrmnx and other Hrmnx sites
 * that should keep the active Nemawashi Music Call visible while browsing.
 *
 * It reuses the site's existing global `supabaseClient` when available.
 * The viewer is NOT inserted into music_call_participants, so the dock
 * does not add a fake participant to the call.
 */
(function () {
    "use strict";

    const state = {
        call: null,
        user: null,
        channel: null,
        peers: new Map(),
        streams: new Map(),
        profiles: new Map(),
        viewerId: null,
        refreshTimer: null,
        rotateTimer: null,
        candidateIds: [],
        candidateIndex: 0,
        busy: false
    };

    function supabaseReady() {
        return typeof supabaseClient !== "undefined" && !!supabaseClient;
    }

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, c => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
        }[c]));
    }

    function isNemawashiRoomOpen() {
        return !!document.querySelector(".music-room-active");
    }

    async function getUser() {
        if (!supabaseReady()) return null;
        try {
            const { data } = await supabaseClient.auth.getUser();
            return data?.user || null;
        } catch (_) {
            return null;
        }
    }

    async function loadProfile(id) {
        if (!id || !supabaseReady()) return null;
        if (state.profiles.has(id)) return state.profiles.get(id);
        const { data } = await supabaseClient
            .from("profiles")
            .select("id,display_name,username")
            .eq("id", id)
            .maybeSingle();
        state.profiles.set(id, data || null);
        return data || null;
    }

    function displayName(id) {
        if (id === state.user?.id) return "You";
        const p = state.profiles.get(id);
        return p?.display_name || p?.username || "Collaborator";
    }

    function closePeer(id) {
        const peer = state.peers.get(id);
        try { peer?.close(); } catch (_) {}
        state.peers.delete(id);
        state.streams.delete(id);
    }

    function closeAllPeers() {
        [...state.peers.keys()].forEach(closePeer);
        state.peers.clear();
        state.streams.clear();
    }

    async function send(payload) {
        try {
            await state.channel?.send({ type: "broadcast", event: "nm4", payload });
        } catch (_) {}
    }

    function createPeer(peerId) {
        if (!peerId || peerId === state.viewerId) return state.peers.get(peerId);
        if (state.peers.has(peerId)) return state.peers.get(peerId);

        const peer = new RTCPeerConnection({
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun.cloudflare.com:3478" }
            ]
        });

        state.peers.set(peerId, peer);

        peer.onicecandidate = event => {
            if (event.candidate) {
                send({ kind: "ice", from: state.viewerId, to: peerId, candidate: event.candidate });
            }
        };

        peer.ontrack = event => {
            let stream = state.streams.get(peerId);
            if (!stream) {
                stream = new MediaStream();
                state.streams.set(peerId, stream);
            }
            if (!stream.getTracks().some(t => t.id === event.track.id)) {
                stream.addTrack(event.track);
            }
            event.track.addEventListener("ended", () => {
                const current = state.streams.get(peerId);
                if (!current) return;
                current.removeTrack(event.track);
                if (!current.getTracks().length) state.streams.delete(peerId);
                renderDock();
            }, { once: true });
            renderDock();
        };

        peer.onconnectionstatechange = () => {
            if (["failed", "closed"].includes(peer.connectionState)) {
                closePeer(peerId);
                renderDock();
            }
        };

        return peer;
    }

    async function makeOffer(peerId) {
        const peer = createPeer(peerId);
        if (!peer || !state.channel) return;
        try {
            const offer = await peer.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
            await peer.setLocalDescription(offer);
            await send({ kind: "offer", from: state.viewerId, to: peerId, description: peer.localDescription });
        } catch (error) {
            console.warn("Nemawashi shared dock offer failed", error);
        }
    }

    async function handleSignal(payload) {
        if (!payload || (payload.to && payload.to !== state.viewerId)) return;

        if (payload.kind === "offer") {
            const peer = createPeer(payload.from);
            if (!peer) return;
            try {
                await peer.setRemoteDescription(payload.description);
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                await send({ kind: "answer", from: state.viewerId, to: payload.from, description: peer.localDescription });
            } catch (error) {
                console.warn("Nemawashi shared dock answer failed", error);
            }
            return;
        }

        if (payload.kind === "answer") {
            const peer = createPeer(payload.from);
            try {
                if (peer && peer.signalingState !== "stable") {
                    await peer.setRemoteDescription(payload.description);
                }
            } catch (_) {}
            return;
        }

        if (payload.kind === "ice") {
            const peer = createPeer(payload.from);
            try { await peer?.addIceCandidate(payload.candidate); } catch (_) {}
            return;
        }

        if (payload.kind === "participant-left") {
            closePeer(payload.userId);
            renderDock();
            return;
        }

        if (payload.kind === "call-ended") {
            await stopDock();
            return;
        }

        if (payload.kind === "hello" && payload.from !== state.viewerId) {
            /* Existing participants may announce themselves. Ask for a stream
               when the viewer's stable ID sorts before theirs. */
            if (String(state.viewerId) < String(payload.from)) {
                await makeOffer(payload.from);
            }
        }
    }

    async function connectChannel(callId) {
        if (!supabaseReady()) return;
        if (state.channel) {
            try { await supabaseClient.removeChannel(state.channel); } catch (_) {}
        }
        state.channel = supabaseClient.channel(`music-call:${callId}:dock-${state.viewerId}`);
        state.channel.on("broadcast", { event: "nm4" }, ({ payload }) => handleSignal(payload));
        await state.channel.subscribe(async status => {
            if (status === "SUBSCRIBED") {
                await send({ kind: "hello", from: state.viewerId });
            }
        });
    }

    async function loadActiveCall() {
        if (!supabaseReady() || !state.user || state.busy) return null;
        state.busy = true;
        try {
            const { data, error } = await supabaseClient
                .from("music_calls")
                .select("id,space_id,host_user_id,project_name,host_daw,status,created_at")
                .eq("status", "active")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
            if (error) return null;
            return data || null;
        } finally {
            state.busy = false;
        }
    }

    async function preparePeers(call) {
        if (!call || !supabaseReady()) return;
        const { data } = await supabaseClient
            .from("music_call_participants")
            .select("user_id,is_online,left_at,kicked_at")
            .eq("call_id", call.id)
            .eq("is_online", true)
            .is("kicked_at", null);

        const participants = (data || []).filter(row => row.user_id !== state.user?.id);
        for (const row of participants) await loadProfile(row.user_id);

        const ids = participants.map(row => row.user_id);
        for (const id of ids) {
            if (String(state.viewerId) < String(id)) {
                await makeOffer(id);
            }
        }
    }

    function renderDock() {
        if (isNemawashiRoomOpen() || !state.call) {
            document.getElementById("nm43-shared-call-dock")?.remove();
            return;
        }

        let dock = document.getElementById("nm43-shared-call-dock");
        if (!dock) {
            dock = document.createElement("aside");
            dock.id = "nm43-shared-call-dock";
            dock.className = "nm43-shared-call-dock";
            document.body.appendChild(dock);
        }

        const streamEntries = [...state.streams.entries()].filter(([, stream]) => stream && stream.getVideoTracks().length);
        state.candidateIds = streamEntries.map(([id]) => id);
        if (state.candidateIndex >= state.candidateIds.length) state.candidateIndex = 0;

        const currentId = state.candidateIds[state.candidateIndex];
        const currentStream = currentId ? state.streams.get(currentId) : null;
        const project = state.call.project_name || "Music Space";
        const label = currentId ? displayName(currentId) : "Waiting for a DAW";

        dock.innerHTML = `
            <div class="nm43-dock-main">
                ${currentStream ? `<video id="nm43-shared-video" autoplay playsinline muted></video>` : `<div class="nm43-dock-empty"><span>♫</span><small>CALL ACTIVE</small></div>`}
                <div class="nm43-dock-overlay">
                    <span class="nm43-dock-live"><i></i> LIVE</span>
                    <strong>${esc(project)}</strong>
                    <small>${esc(label)}${currentStream ? " · DAW" : " · waiting for screen share"}</small>
                </div>
            </div>
            <div class="nm43-dock-actions">
                <button type="button" id="nm43-open-call">Open call</button>
                <button type="button" id="nm43-hide-dock" aria-label="Hide call preview">×</button>
            </div>`;

        const video = dock.querySelector("#nm43-shared-video");
        if (video && currentStream) video.srcObject = currentStream;

        dock.querySelector("#nm43-open-call")?.addEventListener("click", () => {
            window.dispatchEvent(new CustomEvent("nemawashi:open-music-call", { detail: { call: state.call } }));
            const target = window.NEMAWASHI_MUSIC_CALL_URL;
            if (target) window.location.href = target;
        });
        dock.querySelector("#nm43-hide-dock")?.addEventListener("click", () => {
            dock.classList.add("hidden");
            setTimeout(() => dock.remove(), 250);
        });

        clearInterval(state.rotateTimer);
        if (state.candidateIds.length > 1) {
            state.rotateTimer = setInterval(() => {
                if (isNemawashiRoomOpen()) return;
                state.candidateIndex = (state.candidateIndex + 1) % state.candidateIds.length;
                renderDock();
            }, 7000);
        }
    }

    async function startDock(call) {
        if (!call) return;
        if (state.call?.id !== call.id) {
            closeAllPeers();
            state.call = call;
            state.candidateIndex = 0;
            await connectChannel(call.id);
        }
        await preparePeers(call);
        renderDock();
    }

    async function stopDock() {
        clearInterval(state.rotateTimer);
        state.rotateTimer = null;
        closeAllPeers();
        if (state.channel && supabaseReady()) {
            try { await supabaseClient.removeChannel(state.channel); } catch (_) {}
        }
        state.channel = null;
        state.call = null;
        document.getElementById("nm43-shared-call-dock")?.remove();
    }

    async function tick() {
        if (!supabaseReady()) return;
        state.user = state.user || await getUser();
        if (!state.user) {
            await stopDock();
            return;
        }
        state.viewerId = state.viewerId || `dock-${state.user.id}`;
        if (isNemawashiRoomOpen()) {
            document.getElementById("nm43-shared-call-dock")?.remove();
            return;
        }
        const call = await loadActiveCall();
        if (!call) {
            await stopDock();
            return;
        }
        await startDock(call);
    }

    function init() {
        if (!supabaseReady()) {
            setTimeout(init, 1000);
            return;
        }
        tick();
        clearInterval(state.refreshTimer);
        state.refreshTimer = setInterval(tick, 7000);
    }

    window.nemawashiSharedMusicDock = { refresh: tick, stop: stopDock };
    init();
})();
