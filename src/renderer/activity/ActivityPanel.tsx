import { useState, type ReactElement } from 'react'
import type { AgentClient, AgentClientSnapshot } from '../../shared/agent-client'

export function ActivityPanel({ client, snapshot, onInsertSkill }: { client?: AgentClient; snapshot: AgentClientSnapshot; onInsertSkill(name: string): void }): ReactElement {
  const [busy, setBusy] = useState<string>()
  const activity = snapshot.activity
  const sessionId = snapshot.selectedSessionId
  const goal = activity?.goal

  async function run(key: string, action: () => Promise<void>): Promise<void> {
    setBusy(key)
    try { await action() } finally { setBusy(undefined) }
  }

  return <aside className="activity-panel" aria-label="Activity">
    <header><strong>Activity</strong><small>Selected session</small></header>
    <section><h3>Skills</h3>{activity?.skillsState === 'loading' ? <p>Loading…</p> : activity?.skills.length ? activity.skills.map((skill) => <button className="activity-row" key={skill.name} onClick={() => onInsertSkill(skill.name)} title={skill.whenToUse ?? skill.description} type="button"><b>/{skill.name}</b><span>{skill.description}</span></button>) : <p className="activity-empty">No skills published.</p>}</section>
    <section><h3>Subagents</h3>{activity?.subagents.length ? activity.subagents.map((agent) => <div className="activity-card" key={agent.id}><button onClick={() => client?.openSubagent?.(sessionId!, agent.id, agent.mode)} type="button"><b>{agent.label ?? agent.id}</b><span>{agent.mode} · {agent.activity}</span></button>{agent.mode === 'continuable' && agent.activity === 'running' && client?.interruptSubagent ? <button disabled={busy === agent.id} onClick={() => void run(agent.id, () => client.interruptSubagent!(sessionId!, agent.id))} type="button">Interrupt</button> : null}</div>) : <p className="activity-empty">No direct subagents.</p>}</section>
    <section><h3>Goal</h3>{goal ? <div className="activity-card"><b>{goal.objective}</b><span>{goal.phase} · {goal.roundsStarted}/{goal.maxGoalRounds} rounds</span><div className="activity-actions">{goal.phase === 'active' && client?.pauseGoal ? <button onClick={() => void run('goal', () => client.pauseGoal!(sessionId!, goal))} type="button">Pause</button> : null}{goal.phase === 'paused' && client?.resumeGoal ? <button onClick={() => void run('goal', () => client.resumeGoal!(sessionId!, goal))} type="button">Resume</button> : null}{goal.phase !== 'complete' && client?.completeGoal ? <button onClick={() => void run('goal', () => client.completeGoal!(sessionId!, goal))} type="button">Complete</button> : null}{client?.clearGoal ? <button onClick={() => void run('goal', () => client.clearGoal!(sessionId!, goal))} type="button">Clear</button> : null}</div></div> : <p className="activity-empty">No current goal.</p>}</section>
    <section><h3>Jobs</h3>{activity?.jobs.length ? activity.jobs.map((job) => <div className="activity-card" key={job.id}><b>{job.label}</b><span>{job.kind} · {job.status}{job.detail ? ` · ${job.detail}` : ''}</span></div>) : <p className="activity-empty">No background jobs.</p>}</section>
  </aside>
}
