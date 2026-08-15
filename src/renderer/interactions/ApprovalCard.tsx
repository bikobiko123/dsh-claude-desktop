import { useState, type ReactElement } from 'react'
import type { ApprovalDecision, ApprovalInteraction } from '../../shared/agent-client'

export interface ApprovalCardProps {
  interaction: ApprovalInteraction
  onAnswer(decision: ApprovalDecision): Promise<void>
}

export function ApprovalCard({ interaction, onAnswer }: ApprovalCardProps): ReactElement {
  const [submitting, setSubmitting] = useState<ApprovalDecision>()
  const [error, setError] = useState<string>()

  async function answer(decision: ApprovalDecision): Promise<void> {
    setSubmitting(decision)
    setError(undefined)
    try {
      await onAnswer(decision)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The approval response could not be sent.')
      setSubmitting(undefined)
    }
  }

  return (
    <section className="interaction-card approval-card" aria-label={`Approval required for ${interaction.toolName}`}>
      <div className="interaction-kicker">Permission requested</div>
      <h2>{interaction.toolName}</h2>
      <p>{interaction.reason ?? 'Harness needs your approval before it can continue with this tool.'}</p>
      {interaction.callId ? <code className="interaction-meta">Call {interaction.callId}</code> : null}
      {error ? <div className="interaction-error" role="alert">{error}</div> : null}
      <div className="interaction-actions">
        <button disabled={submitting !== undefined} onClick={() => void answer('rejected')} type="button">Decline</button>
        <button className="interaction-primary" disabled={submitting !== undefined} onClick={() => void answer('allowed-once')} type="button">
          {submitting === 'allowed-once' ? 'Allowing…' : 'Allow once'}
        </button>
      </div>
    </section>
  )
}
