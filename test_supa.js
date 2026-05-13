const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const supabase = createClient(
    'https://tzdwxrdkqcntskwdvkfl.supabase.co', 
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6ZHd4cmRrcWNudHNrd2R2a2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2ODUzNjksImV4cCI6MjA5NDI2MTM2OX0.MpMEqeXXgAGuOwu9fCgSYMmWsP4JHze2s2DerNrUBu4',
    { auth: { persistSession: false }, global: { fetch: fetch }, realtime: { transport: WebSocket } }
);

async function test() {
    console.log("Checking accounts...");
    const { data: accounts, error: accErr } = await supabase.from('accounts').select('*');
    console.log("Accounts:", accounts, accErr);

    console.log("Checking users...");
    const { data: users, error: usrErr } = await supabase.from('users').select('*');
    console.log("Users:", users, usrErr);
}

test();