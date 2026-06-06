import { Fragment } from 'react';
import { encode } from 'qss';

const googleClientId = '398759449450-vg8cjqnd5om8td4krs398f805k2em8uj.apps.googleusercontent.com';
const googleScope =
  'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events.readonly';

const getGoogleAuthUrl = () => {
  const params = encode({
    client_id: googleClientId,
    redirect_uri: 'https://doehyunbaek.github.io/calendar/',
    // redirect_uri: 'http://localhost:3000/calendar/',
    scope: googleScope,
    response_type: 'token',
  });

  return `https://accounts.google.com/o/oauth2/auth?${params}`;
};

const AuthScreen = () => (
  <Fragment>
    <p>
      This web app lets you see how many hours you spend on a Google Calendar.
      It uses the Google Calendar API to fetch your calendars and events,
      crunches the data and displays it nicely. You can filter by day, week,
      month, year, total or add a custom time range.
    </p>

    <p>You need to authorize the app with the following link:</p>
    <a href={getGoogleAuthUrl()} data-testid="AuthLink">
      <img
        src="./google_auth.png"
        alt="Auth with Google"
        width="191"
        height="46"
      />
    </a>

    <h3>Privacy Policy</h3>
    <p>
      This app connects to the Google Calendar API to fetch your calendars and
      events, so that it can calculate the hours. This connection happens
      directly from your browser to the Google API. There are no server or
      services involved that might cache the data.
    </p>
    <p>This app only has read-only access to your calendar data.</p>
  </Fragment>
);

export default AuthScreen;
