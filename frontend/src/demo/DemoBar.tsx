import { useState } from "react";
import { DEMO_PASSWORD, demoAccounts, resetDemo } from "./mockApi";

/** Floating panel with the demo accounts and a reset button. Demo build only. */
export function DemoBar() {
  const [open, setOpen] = useState(() => !localStorage.getItem("pp-demo-seen"));
  const accounts = demoAccounts();
  return (
    <div className={`demo-bar${open ? " open" : ""}`}>
      <button type="button" className="demo-toggle" onClick={() => { setOpen(!open); localStorage.setItem("pp-demo-seen", "1"); }} aria-expanded={open}>
        {open ? "Hide demo accounts ▾" : "Demo accounts ▴"}
      </button>
      {open && (
        <div className="demo-body">
          <p>
            Everything runs in this browser tab: no server, no real security, and nothing leaves your device.
            The AI analysis here is a rule-based stand-in, not a language model.
            Password for every account: <code>{DEMO_PASSWORD}</code>
          </p>
          <table>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.username}><td><code>{a.username}</code></td><td>{a.name}</td><td className="role">{a.role}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="tip">
            Sign out from the user menu at the top right to switch person. As <code>m.rabie</code> (Presales Lead):
            open the Red Sea Global opportunity — a sample RFP is already attached — and submit it. As
            <code>a.aloulah</code> (Presales Director): review it, add comments, mark it Ready for AI, then run the
            analysis on the AI tab.
          </p>
          <button type="button" className="btn ghost small" onClick={() => { resetDemo(); location.reload(); }}>
            Reset demo data
          </button>
        </div>
      )}
    </div>
  );
}
