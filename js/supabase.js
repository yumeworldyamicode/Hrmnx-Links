/* Hrmnx Links / Shop public Supabase client.
 * The publishable key is intended for browser use. Row Level Security must
 * remain enabled for every exposed table; never put a service-role key here.
 */
(function () {
  "use strict";

  const SUPABASE_URL = "https://bftgnubawqwvpbqkldpm.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Uoky-Y8iSnzCu0wOa5_y-w_McCGJcJ4";

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("Supabase JS did not load. Check the CDN connection.");
    return;
  }

  window.hrmnxSupabase = window.hrmnxSupabase || window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );
})();