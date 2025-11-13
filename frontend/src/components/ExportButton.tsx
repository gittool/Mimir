import { Download } from 'lucide-react';
import { usePlanStore } from '../store/planStore';

export function ExportButton() {
  const { tasks, exportToMarkdown } = usePlanStore();

  const handleExport = () => {
    const markdown = exportToMarkdown();
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chain-output.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={tasks.length === 0}
      className="px-5 py-2.5 bg-frost-ice text-norse-night font-semibold rounded-lg hover:bg-frost-glacial disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 transition-all shadow-lg hover:shadow-frost-ice/30"
    >
      <Download className="w-5 h-5" />
      <span>Export chain-output.md</span>
    </button>
  );
}
