import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { user_id } = await req.json()

  if (!user_id) {
    return new Response(JSON.stringify({ error: 'user_id is required' }), { headers: corsHeaders, status: 400 })
  }

// Sign out all sessions first
  await supabaseAdmin.auth.admin.signOut(user_id, 'global')

  // Then delete the user
  const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 400 })
  }

  return new Response(JSON.stringify({ success: true }), { headers: corsHeaders, status: 200 })
})