import { useEffect, useState } from "react";

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function SubmitModal({ isOpen, onClose, onSubmit, dailyInstalled }) {
  const [date, setDate] = useState(todayIso);
  const [subcontractor, setSubcontractor] = useState("ENEL");
  const [workers, setWorkers] = useState("0");

  useEffect(() => {
    if (isOpen) {
      setDate(todayIso());
      setSubcontractor("ENEL");
      setWorkers("0");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.({
      date,
      subcontractor: subcontractor.trim(),
      workers: Number(workers) || 0
    });
  };

  return (
    <div className="lv-modal" role="dialog" aria-modal="true">
      <div className="lv-modal__content">
        <header className="lv-modal__header">
          <h2>Submit Daily Work</h2>
          <button type="button" className="lv-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <form className="lv-modal__form" onSubmit={handleSubmit}>
          <label>
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>

          <label>
            <span>Subcontractor</span>
            <input
              type="text"
              value={subcontractor}
              onChange={(e) => setSubcontractor(e.target.value)}
              placeholder="Company name"
              required
            />
          </label>

          <label>
            <span>Workers on Site</span>
            <input
              type="number"
              min="0"
              value={workers}
              onChange={(e) => setWorkers(e.target.value)}
              required
            />
          </label>

          <p className="lv-modal__summary">
            Installed today: <strong>{dailyInstalled.toLocaleString()}</strong>
          </p>

          <div className="lv-modal__actions">
            <button type="button" className="lv-button lv-button--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="lv-button">
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
