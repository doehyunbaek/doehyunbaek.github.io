'use client';

import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { decode } from 'qss';

import { selectHasToken, setToken } from './stores/authentication';

import AuthScreen from './AuthScreen';
import Interface from './Interface';

import styles from './App.module.css';

const App = () => {
  const dispatch = useDispatch();
  const hasToken = useSelector(selectHasToken);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);

    const savedToken = localStorage.getItem('accessToken');
    if (savedToken) {
      dispatch(setToken(savedToken));
    }

    const hashParams = decode(window.location?.hash?.slice(1) ?? '');
    if (hashParams.access_token) {
      localStorage.setItem('accessToken', hashParams.access_token);
      dispatch(setToken(hashParams.access_token));
      window.history.replaceState(null, '', '/calendar/');
    }
  }, [dispatch]);

  return (
    <div className={styles.appWrapper}>
      <div className={styles.app}>
        <div className={styles.sticky}>
          <div className={styles.content}>
            <h1 className={styles.headline}>
              Google Calendar Hours Calculator
            </h1>
            {isHydrated && (!hasToken ? <AuthScreen /> : <Interface />)}
          </div>
          <footer className={styles.footer}>
            <p>
              <span>© 2011 - 2024. This app is open source. </span>
              <a
                href="https://github.com/aronwoost/google-calendar-hours"
                target="_blank"
                rel="noreferrer"
              >
                Check it on GitHub
              </a>
              <span>.</span>
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default App;
