export default function ProgressStats({
  totalMeters,
  completedMeters,
  completionPercentage,
  remainingMeters
}) {
  return (
    <section className="lv-panel">
      <div className="lv-panel__info">
        <h1>ENEL Work Tracker</h1>
        <p className="lv-panel__total">
          Total: {totalMeters.toLocaleString()}m | Completed: {completedMeters.toLocaleString()}m | {completionPercentage}% | Remaining: {remainingMeters.toLocaleString()}m
        </p>
      </div>
    </section>
  );
}

function Metric({ label, value, isText = false }) {
  return (
    <div className="lv-metric">
      <span>{label}</span>
      {isText ? <strong>{value}</strong> : <strong>{Number(value).toLocaleString()}</strong>}
    </div>
  );
}
