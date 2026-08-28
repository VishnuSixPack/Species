// supabase-init.js — shared across all pages
// Uses the same key as login.js
if(!window.dbClient){
  var SUPABASE_URL='https://enbdaajcromxmhgcverp.supabase.co';
  var SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuYmRhYWpjcm9teG1oZ2N2ZXJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMjc4MTUsImV4cCI6MjA5MzcwMzgxNX0.wlVbN57eAwRmTROEEY3D6BIX3H5pI6MwZ5hM2BqpnEs';
  window.dbClient=window.supabase?window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY):null;
}
