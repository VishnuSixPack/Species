/* ==========================================================================
   EU Catch Support — shared configuration

   Load this BEFORE any of the EU Catch pages' own scripts:

       <script src="eu-catch-config.js"></script>

   The key below is a Supabase *publishable* key. It is designed to be sent to
   the browser and is safe to deploy in client-side files — row level security
   is what actually protects the data, not secrecy of this string. Never put a
   service_role key here.
   ========================================================================== */

window.EUCATCH_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
window.EUCATCH_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';

/* Supabase Storage bucket holding raw-material attachments, used to build
   links for the certificate's supporting documents. Change if yours differs. */
window.EUCATCH_DOC_BUCKET = 'raw-material-documents';
