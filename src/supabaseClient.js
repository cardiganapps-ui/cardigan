import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://axyuqfkmifcaupwhzfuw.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4eXVxZmttaWZjYXVwd2h6ZnV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MTMyODksImV4cCI6MjA5MTE4OTI4OX0.8T-_1k64HeNf8Xc4-2fODGG-2lZCPDE66pNXcsRe5YU'

export const supabase = createClient(supabaseUrl, supabaseKey)