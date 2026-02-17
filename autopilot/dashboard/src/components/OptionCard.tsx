// Clickable option card for question response forms.
// Shows label (bold) and description with selected/disabled visual states.

export interface OptionCardProps {
  label: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}

export function OptionCard({
  label,
  description,
  selected,
  disabled,
  onClick,
}: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`p-4 rounded-lg border-2 text-left transition-colors ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'cursor-pointer hover:border-blue-300'
      } ${
        selected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white'
      }`}
    >
      <div className="font-bold text-gray-900">{label}</div>
      <div className="text-sm text-gray-600 mt-1">{description}</div>
    </button>
  );
}
