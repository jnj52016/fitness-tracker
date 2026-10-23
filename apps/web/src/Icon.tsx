const paths = {
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none" /><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none" /></>,
  history: <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2" />,
  data: <path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h3" />,
};
export default function Icon({ name }: { name: keyof typeof paths }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
