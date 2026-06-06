import { createSlice } from '@reduxjs/toolkit';

import { selectAccessToken } from './authentication';
import { selectCalendars } from '../stores/calendars';
import { useSelector, useDispatch } from 'react-redux';
import { fetchCalendarEvents } from './api';

export const calendarEvents = createSlice({
  name: 'calendarEvents',
  initialState: {
    loading: false,
    map: {},
  },
  reducers: {
    setCalendarEvents: (state, { payload }) => {
      state.map[payload.calendarId] = payload.events;
    },
    setLoading: (state, { payload }) => {
      state.loading = payload;
    },
  },
});

const { setCalendarEvents, setLoading } = calendarEvents.actions;

export const loadCalendarEvents =
  ({ calendarId }) =>
  async (dispatch, getState) => {
    const accessToken = selectAccessToken(getState());

    try {
      dispatch(setLoading(true));
      console.trace(calendarId)

      if (calendarId === 'total') {
        // Fetch events for all calendars when "Total" is selected
        const state = getState();
        const calendars = selectCalendars(state); // Use the existing selector
        const calendarIds = calendars?.map((calendar) => calendar.id) ?? []; // Extract IDs

        for (const id of calendarIds) {
          const existingEvents = state.calendarEvents?.map[id];
          if (!existingEvents || existingEvents.length === 0) {
            // Fetch events if they are missing or empty
            const items = await fetchCalendarEvents({ accessToken, calendarId: id });
            dispatch(
              setCalendarEvents({
                calendarId: id,
                events: items
                  .map(({ id, summary, start, end }) => {
                    if (!start.dateTime) {
                      return null;
                    }
                    return {
                      id,
                      summary,
                      start: start.dateTime,
                      end: end.dateTime,
                    };
                  })
                  .filter(Boolean),
              })
            );
          }
        }
      } else {
        const items = await fetchCalendarEvents({ accessToken, calendarId });
        dispatch(
          setCalendarEvents({
            calendarId,
            events: items
              .map(({ id, summary, start, end }) => {
                if (!start.dateTime) {
                  return null;
                }
                return {
                  id,
                  summary,
                  start: start.dateTime,
                  end: end.dateTime,
                };
              })
              .filter(Boolean),
          })
        );
      }
    } catch (e) {
      // Handle errors (optional logging or error dispatch)
      console.error('Error fetching calendar events:', e);
    } finally {
      dispatch(setLoading(false));
    }
  };

export const selectIsEventsLoading = (state) =>
  state.calendarEvents?.loading ?? false;

export const selectCalendarEvents = (state, calendarId) => {
  // console.trace('selectCalendarEvents', state, calendarId)
  if (calendarId === 'total') {
    const allEvents = Object.values(state.calendarEvents?.map || {}).flat();
    return allEvents.length > 0 ? allEvents : null;
  }
  const partialEvents = (!selectIsEventsLoading(state) && state.calendarEvents?.map[calendarId]) ?? null;
  return partialEvents
};

export default calendarEvents.reducer;
