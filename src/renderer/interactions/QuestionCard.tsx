import { useMemo, useState, type FormEvent, type ReactElement } from 'react'
import type { QuestionAnswerItem, QuestionInteraction } from '../../shared/agent-client'

export interface QuestionCardProps {
  interaction: QuestionInteraction
  onAnswer(answers: readonly QuestionAnswerItem[]): Promise<void>
}

type DraftAnswer = { selected: string[]; custom: string }

export function QuestionCard({ interaction, onAnswer }: QuestionCardProps): ReactElement {
  const initial = useMemo(() => Object.fromEntries(interaction.questions.map((question) => [question.id, { selected: [], custom: '' }])), [interaction])
  const [answers, setAnswers] = useState<Record<string, DraftAnswer>>(initial)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  function toggle(questionId: string, label: string, multiSelect: boolean): void {
    setAnswers((current) => {
      const answer = current[questionId] ?? { selected: [], custom: '' }
      const selected = multiSelect
        ? answer.selected.includes(label) ? answer.selected.filter((item) => item !== label) : [...answer.selected, label]
        : [label]
      return { ...current, [questionId]: { ...answer, selected } }
    })
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    try {
      await onAnswer(interaction.questions.map((question) => {
        const answer = answers[question.id] ?? { selected: [], custom: '' }
        return {
          id: question.id,
          selected: answer.selected,
          ...(answer.custom.trim() ? { custom: answer.custom.trim() } : {}),
        }
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The answer could not be sent.')
      setSubmitting(false)
    }
  }

  const valid = interaction.questions.every((question) => {
    const answer = answers[question.id]
    return Boolean(answer && (answer.selected.length > 0 || answer.custom.trim()))
  })

  return (
    <form className="interaction-card question-card" onSubmit={(event) => void submit(event)}>
      <div className="interaction-kicker">Harness has a question</div>
      {interaction.questions.map((question) => {
        const answer = answers[question.id] ?? { selected: [], custom: '' }
        return (
          <fieldset className="question-group" key={question.id}>
            {question.header ? <div className="question-header">{question.header}</div> : null}
            <legend>{question.question}</legend>
            {question.detail ? <p>{question.detail}</p> : null}
            {question.options.length ? <div className="question-options">
              {question.options.map((option) => {
                const selected = answer.selected.includes(option.label)
                return (
                  <button
                    aria-pressed={selected}
                    className={selected ? 'question-option question-option-selected' : 'question-option'}
                    key={option.label}
                    onClick={() => toggle(question.id, option.label, question.multiSelect)}
                    type="button"
                  >
                    <strong>{option.label}</strong>
                    {option.description ? <span>{option.description}</span> : null}
                  </button>
                )
              })}
            </div> : null}
            <input
              aria-label={`Other answer for ${question.question}`}
              onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: { ...answer, custom: event.target.value } }))}
              placeholder="Or type another answer"
              value={answer.custom}
            />
          </fieldset>
        )
      })}
      {error ? <div className="interaction-error" role="alert">{error}</div> : null}
      <div className="interaction-actions">
        <button className="interaction-primary" disabled={!valid || submitting} type="submit">{submitting ? 'Sending…' : 'Continue'}</button>
      </div>
    </form>
  )
}
