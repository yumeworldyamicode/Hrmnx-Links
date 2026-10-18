(function () {
  "use strict";

  const page = document.querySelector("[data-release-page]");
  if (!page) return;

  const slug = page.dataset.slug;
  const shopSection = document.querySelector("#releaseShop");
  const productsContainer = document.querySelector("#releaseProducts");
  const shopLink = document.querySelector("#shopArtistLink");

  // Social crawlers generally do not execute JavaScript. Each URL therefore
  // has its own static Open Graph tags in its index.html file.
  async function loadReleaseProducts() {
    const client = window.hrmnxSupabase;
    if (!client || !slug || !shopSection || !productsContainer) return;

    try {
      const { data: release, error: releaseError } = await client
        .from("links_releases")
        .select("id, artist_slug, slug, title")
        .eq("artist_slug", "seiun")
        .eq("slug", slug)
        .eq("is_published", true)
        .maybeSingle();

      if (releaseError || !release) return;

      const { data: products, error } = await client
        .from("shop_products")
        .select("id, name, description, price_amount, currency, image_url, checkout_url")
        .eq("release_id", release.id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error || !products || products.length === 0) return;

      productsContainer.replaceChildren();
      products.forEach((product) => {
        const card = document.createElement("article");
        card.className = "product";

        if (product.image_url) {
          const image = document.createElement("img");
          image.src = product.image_url;
          image.alt = product.name || "Release merchandise";
          image.loading = "lazy";
          card.appendChild(image);
        }

        const info = document.createElement("div");
        info.className = "product-info";
        const name = document.createElement("div");
        name.className = "product-name";
        name.textContent = product.name || "SEIUN merchandise";
        info.appendChild(name);

        if (product.price_amount != null) {
          const price = document.createElement("div");
          price.className = "product-price";
          try {
            price.textContent = new Intl.NumberFormat(undefined, {
              style: "currency", currency: product.currency || "EUR"
            }).format(Number(product.price_amount));
          } catch (_) {
            price.textContent = String(product.price_amount) + " " + (product.currency || "EUR");
          }
          info.appendChild(price);
        }

        if (product.checkout_url) {
          const buy = document.createElement("a");
          buy.className = "product-buy";
          buy.href = product.checkout_url;
          buy.target = "_blank";
          buy.rel = "noopener noreferrer";
          buy.textContent = "View product";
          info.appendChild(buy);
        }

        card.appendChild(info);
        productsContainer.appendChild(card);
      });

      if (shopLink) shopLink.href = "https://shop.hrmnx.site/seiun";
      shopSection.classList.remove("hidden");
    } catch (error) {
      // The release page remains usable if the optional shop backend is offline.
      console.warn("Release merchandise could not be loaded.", error);
    }
  }

  loadReleaseProducts();
})();