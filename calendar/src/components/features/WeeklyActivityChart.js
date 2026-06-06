import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useSelector } from 'react-redux';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';

import { selectEventsByRange } from '../stores/viewState';

dayjs.extend(isoWeek);

export function classifyEventsByWeek(events) {
  const data = {};
  const allowedCategories = ['read', 'code', 'write', 'meet'];

  events.forEach(({ start, end, summary }) => {
    const week = dayjs(start).isoWeek();
    const year = dayjs(start).year();
    const hours = (new Date(end) - new Date(start)) / 1000 / 60 / 60;

    const prefix = summary.split(':')[0].toLowerCase().trim(); // e.g., "read"

    if (!allowedCategories.includes(prefix)) return; // Ignore categories not in the allowed list

    const key = `${year}-W${week.toString().padStart(2, '0')}`;

    if (!data[key]) data[key] = {};
    data[key][prefix] = (data[key][prefix] || 0) + hours;
  });

  // Convert to sorted array and calculate cumulative values
  const sortedData = Object.entries(data)
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([week, values]) => ({ week, ...values }));

  // Calculate cumulative values
  const cumulativeData = [];
  const cumulativeTotals = {};

  sortedData.forEach((row) => {
    const cumulativeRow = { week: row.week };
    allowedCategories.forEach((category) => {
      cumulativeTotals[category] = (cumulativeTotals[category] || 0) + (row[category] || 0);
      cumulativeRow[category] = cumulativeTotals[category];
    });
    cumulativeData.push(cumulativeRow);
  });


  return cumulativeData;
}

const WeeklyActivityChart = () => {
  const events = useSelector(selectEventsByRange);
  const data = classifyEventsByWeek(events);

  const allKeys = new Set();
  data.forEach((row) => {
    Object.keys(row).forEach((k) => {
      if (k !== 'week') allKeys.add(k);
    });
  });

  const colors = ['#8884d8', '#82ca9d', '#ffc658', '#d84e4e', '#4ecad8'];
  const keys = Array.from(allKeys);

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="week" />
        <YAxis label={{ value: 'Hours', angle: -90, position: 'insideLeft' }} />
        <Tooltip />
        <Legend />
        {keys.map((key, idx) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={colors[idx % colors.length]}
            strokeWidth={2}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

export default WeeklyActivityChart;