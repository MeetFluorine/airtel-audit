// Public values only. The anon key is designed to sit in the browser; RLS protects the data.
// NEVER put the service_role key in this repo.
const SUPABASE_URL = 'https://uyuexvwzeejconbewbmq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5dWV4dnd6ZWVqY29uYmV3Ym1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0Nzg3NjgsImV4cCI6MjEwNzA1NDc2OH0.KYB4eQuhAT67orT7Liv2GhX7QYoqf4wfOJOu7tuhnWo';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
