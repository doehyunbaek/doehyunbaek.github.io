import { useSelector, useDispatch } from 'react-redux';

import { selectCalendars } from '../stores/calendars';
import {
  selectSelectedCalendar,
  setSelectedCalendar,
} from '../stores/viewState';

const CalendarsList = () => {
  const dispatch = useDispatch();

  const calendars = useSelector(selectCalendars);
  const selectedCalendar = useSelector(selectSelectedCalendar);

  return (
    <select
      data-testid="CalendarsList"
      className="form-select"
      onChange={(event) => {
        const value = event.target.value;
        dispatch(setSelectedCalendar({ calendarId: value === 'total' ? 'total' : value }));
      }}
      value={selectedCalendar ?? 'total'}
    >
      {
        <option key="default" value="total">
          Total
        </option>
      }
      {calendars.map(({ id, label }) => (
        <option value={id} key={id}>
          {label}
        </option>
      ))}
    </select>
  );
};

export default CalendarsList;