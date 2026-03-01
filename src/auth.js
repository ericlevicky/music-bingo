/**
 * auth.js – Passport configuration for Google OAuth 2.0.
 *
 * Admins sign in with their Gmail/Google account.
 * The resulting session carries the admin's Google ID which is used to look up
 * their AdminData in the store.
 */

'use strict';

const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const store = require('./store');

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.warn(
    '[auth] WARNING: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. ' +
    'Admin login will not work until these are configured in your .env file.'
  );
}
passport.use(
  new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID || 'PLACEHOLDER',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'PLACEHOLDER',
      callbackURL:
        process.env.GOOGLE_REDIRECT_URI ||
        'http://localhost:3000/auth/google/callback',
    },
    (_accessToken, _refreshToken, profile, done) => {
      if (!process.env.GOOGLE_CLIENT_ID) {
        return done(new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.'));
      }
      try {
        const admin = store.getOrCreate(profile.id, {
          googleId: profile.id,
          email:    profile.emails && profile.emails[0] ? profile.emails[0].value : '',
          name:     profile.displayName,
          picture:  profile.photos && profile.photos[0] ? profile.photos[0].value : null,
        });
        return done(null, admin);
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.serializeUser((admin, done) => {
  done(null, admin.googleId);
});

passport.deserializeUser((googleId, done) => {
  const admin = store.getAdmin(googleId);
  done(null, admin || false);
});

module.exports = passport;
