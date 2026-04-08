import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://axyuqfkmifcaupwhzfuw.supabase.co'
const supabaseKey = 'sb_publishable_fg2F4VcZ0qUk-d8DnIsP_A_jSKJ3xm2'

export const supabase = createClient(supabaseUrl, supabaseKey)