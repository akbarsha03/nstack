import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loggedOut, loggedIn, onLoginPage } from '../src/main/persona.js';

const B = 'http://localhost:3000', L = '/sign-in';

test('login page = same origin, loginPath or below it', () => {
  assert.ok(onLoginPage('http://localhost:3000/sign-in', B, L));
  assert.ok(onLoginPage('http://localhost:3000/sign-in?return=/x', B, L));
  assert.ok(onLoginPage('http://localhost:3000/sign-in/otp', B, L));
  assert.ok(!onLoginPage('http://localhost:3000/sign-instructions', B, L));
  assert.ok(!onLoginPage('http://localhost:4000/sign-in', B, L));
  assert.ok(!onLoginPage('not a url', B, L));
});

test('a redirect from an app page to loginPath means logged out', () => {
  assert.ok(loggedOut(`${B}/dashboard`, `${B}/sign-in`, B, L));
  // opening the login page on purpose is not a logout
  assert.ok(!loggedOut(`${B}/sign-in`, `${B}/sign-in`, B, L));
  assert.ok(!loggedOut(`${B}/dashboard`, `${B}/dashboard`, B, L));
});

test('logged in once the app lets us off loginPath on its own origin', () => {
  assert.ok(loggedIn(`${B}/dashboard`, B, L));
  assert.ok(!loggedIn(`${B}/sign-in`, B, L));
  assert.ok(!loggedIn('https://accounts.google.com/o/oauth2', B, L));
  assert.ok(!loggedIn('about:blank', B, L));
});
