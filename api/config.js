// Gives the app its Supabase connection details from Vercel's environment variables,
// so nobody has to type them on the login screen. The anon key is designed to be public;
// your data is protected by the sign-in rules in Supabase, not by hiding this key.
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) { res.status(200).json({ configured: false }); return; }
  res.status(200).json({ configured: true, supabaseUrl: url, supabaseKey: key });
};
