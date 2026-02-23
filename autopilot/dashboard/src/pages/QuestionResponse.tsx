// Question response page (DASH-15, DASH-16).
// Renders question markdown, option cards, freeform text input, and submit flow.
// DASH-16: User can freely change selections and freeform text before clicking Submit.
// After submission the form is disabled and shows Submitted state.

import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import Markdown from 'react-markdown';
import { submitAnswer } from '../api/client.js';
import { useDashboardStore } from '../store/index.js';
import { OptionCard } from '../components/OptionCard.js';

export function QuestionResponse() {
  const { questionId } = useParams();
  const navigate = useNavigate();
  const questions = useDashboardStore((s) => s.questions);
  const question = questions.find((q) => q.id === questionId);

  // Local form state -- user can change answers before submitting (DASH-16)
  // Multi-select questions store arrays; single-select stores single strings.
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [freeform, setFreeform] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!question) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">
            Question not found or already answered
          </h2>
          <Link to="/" className="text-blue-600 hover:text-blue-800 underline">
            Back to Overview
          </Link>
        </div>
      </div>
    );
  }

  const handleSelectOption = (questionText: string, label: string, multiSelect: boolean) => {
    if (submitted || submitting) return;
    if (multiSelect) {
      setAnswers((prev) => {
        const current = prev[questionText];
        const selected = Array.isArray(current) ? current : [];
        const next = selected.includes(label)
          ? selected.filter((l) => l !== label)
          : [...selected, label];
        return { ...prev, [questionText]: next };
      });
    } else {
      setAnswers((prev) => ({ ...prev, [questionText]: label }));
    }
  };

  const handleFreeformChange = (questionText: string, value: string) => {
    if (submitted || submitting) return;
    setFreeform((prev) => ({ ...prev, [questionText]: value }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // Merge option selections with freeform text.
      // Freeform takes priority if non-empty.
      // Multi-select arrays are joined to comma-separated strings for the API.
      const merged: Record<string, string> = {};
      for (const [key, val] of Object.entries(answers)) {
        merged[key] = Array.isArray(val) ? val.join(', ') : val;
      }
      for (const [key, val] of Object.entries(freeform)) {
        if (val.trim()) merged[key] = val;
      }
      await submitAnswer(questionId!, merged);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit response');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      {/* Back navigation */}
      <button
        type="button"
        onClick={() => { navigate('/'); }}
        className="text-blue-600 hover:text-blue-800 mb-6 inline-flex items-center gap-1"
      >
        &larr; Back to Overview
      </button>

      {/* Phase context */}
      {question.phase != null && (
        <div className="text-sm text-gray-500 mb-2">
          Phase {question.phase}
          {question.step ? ` / ${question.step}` : ''}
        </div>
      )}

      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Respond to Question
      </h1>

      {/* Success banner */}
      {submitted && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 mb-6">
          Response submitted. The build will continue.
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 mb-6">
          {error}
        </div>
      )}

      {/* Question items */}
      {question.questions.map((q) => (
        <div
          key={q.question}
          className="border border-gray-200 rounded-lg p-6 mb-6 bg-white"
        >
          {/* Section header */}
          {q.header && (
            <h3 className="text-lg font-semibold text-gray-800 mb-3">
              {q.header}
            </h3>
          )}

          {/* Question text with markdown rendering */}
          <div className="prose prose-sm max-w-none mb-4 text-gray-700">
            <Markdown>{q.question}</Markdown>
          </div>

          {/* Option cards grid */}
          {q.options.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {q.options.map((opt) => {
                const ans = answers[q.question];
                const isSelected = Array.isArray(ans)
                  ? ans.includes(opt.label)
                  : ans === opt.label;
                return (
                  <OptionCard
                    key={opt.label}
                    label={opt.label}
                    description={opt.description}
                    selected={isSelected}
                    disabled={submitted || submitting}
                    onClick={() => { handleSelectOption(q.question, opt.label, q.multiSelect); }}
                  />
                );
              })}
            </div>
          )}

          {/* Freeform text input */}
          <textarea
            placeholder="Or type a custom response..."
            value={freeform[q.question] ?? ''}
            onChange={(e) => { handleFreeformChange(q.question, e.target.value); }}
            disabled={submitted || submitting}
            className="w-full p-3 border border-gray-200 rounded-lg text-sm resize-y min-h-[80px] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          />
        </div>
      ))}

      {/* Submit button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => { void handleSubmit(); }}
          disabled={submitting || submitted}
          className={`px-6 py-3 rounded-lg font-medium transition-colors ${
            submitted
              ? 'bg-green-600 text-white cursor-not-allowed'
              : submitting
                ? 'bg-blue-400 text-white cursor-wait'
                : 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
          } disabled:opacity-75`}
        >
          {submitted
            ? '\u2713 Submitted'
            : submitting
              ? 'Submitting...'
              : 'Submit Response'}
        </button>
      </div>
    </div>
  );
}
