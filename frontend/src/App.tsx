import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { PromptInput } from './components/PromptInput';
import { AgentPalette } from './components/AgentPalette';
import { TaskCanvas } from './components/TaskCanvas';
import { TaskEditor } from './components/TaskEditor';
import { ExportButton } from './components/ExportButton';
import { AgentDragPreview } from './components/AgentDragPreview';
import { ErrorModal } from './components/ErrorModal';
import { usePlanStore } from './store/planStore';

function App() {
  const { globalError, setGlobalError } = usePlanStore();
  
  return (
    <DndProvider backend={HTML5Backend}>
      <AgentDragPreview />
      <ErrorModal
        isOpen={globalError !== null}
        title={globalError?.title || ''}
        message={globalError?.message || ''}
        details={globalError?.details}
        onClose={() => setGlobalError(null)}
      />
      <div className="h-screen flex flex-col bg-norse-night">
        {/* Header */}
        <header className="bg-norse-shadow border-b border-norse-rune px-6 py-4 flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-3">
            <img 
              src="/mimir-logo.png" 
              alt="Mimir Logo" 
              className="h-12 w-auto"
            />
            <div>
              <h1 className="text-2xl font-bold text-valhalla-gold">Mimir Orchestration Studio</h1>
              <p className="text-sm text-gray-400">Visual Agent Task Planner</p>
            </div>
          </div>
          <ExportButton />
        </header>

        {/* Prompt Input */}
        <div className="bg-norse-shadow border-b border-norse-rune px-6 py-4">
          <PromptInput />
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar - Agent Palette */}
          <aside className="w-80 bg-norse-shadow border-r border-norse-rune overflow-y-auto scroll-container">
            <AgentPalette />
          </aside>

          {/* Center - Task Canvas */}
          <main className="flex-1 overflow-y-auto scroll-container">
            <TaskCanvas />
          </main>

          {/* Right Sidebar - Task Editor */}
          <aside className="w-96 bg-norse-shadow border-l border-norse-rune overflow-y-auto scroll-container">
            <TaskEditor />
          </aside>
        </div>
      </div>
    </DndProvider>
  );
}

export default App;
