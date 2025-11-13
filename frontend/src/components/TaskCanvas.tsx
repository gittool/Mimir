import { useDrop, useDrag } from 'react-dnd';
import { usePlanStore } from '../store/planStore';
import { ParallelGroupContainer } from './ParallelGroupContainer';
import { TaskCard } from './TaskCard';
import { Plus, ListPlus, GripVertical } from 'lucide-react';
import { Task, AgentTemplate } from '../types/task';
import { useRef } from 'react';

interface ReorderableTaskCardProps {
  task: Task;
  index: number;
  onReorder: (taskId: string, newOrder: number) => void;
}

function ReorderableTaskCard({ task, index, onReorder }: ReorderableTaskCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: 'reorderable-task',
    item: { type: 'reorderable-task', task, index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [{ isOver }, drop] = useDrop({
    accept: 'reorderable-task',
    hover: (item: { task: Task; index: number }, monitor) => {
      if (!ref.current) return;
      
      const dragIndex = item.index;
      const hoverIndex = index;
      
      if (dragIndex === hoverIndex) return;
      
      // Don't trigger on first hover to avoid jitter
      const hoverBoundingRect = ref.current?.getBoundingClientRect();
      const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
      const clientOffset = monitor.getClientOffset();
      const hoverClientY = clientOffset!.y - hoverBoundingRect.top;
      
      // Only perform the move when the mouse has crossed half of the items height
      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) return;
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) return;
      
      onReorder(item.task.id, hoverIndex);
      item.index = hoverIndex;
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  drag(drop(ref));

  return (
    <div
      ref={ref}
      className={`flex items-stretch gap-2 transition-opacity ${
        isDragging ? 'opacity-50' : 'opacity-100'
      } ${isOver ? 'border-l-4 border-valhalla-gold' : ''}`}
    >
      <div className="flex items-center cursor-move text-gray-500 hover:text-valhalla-gold transition-colors">
        <GripVertical className="w-5 h-5" />
      </div>
      <div className="flex-1">
        <TaskCard task={task} disableDrag={true} />
      </div>
    </div>
  );
}

export function TaskCanvas() {
  const { tasks, parallelGroups, addTask, addParallelGroup, assignTaskToGroup, reorderTask } = usePlanStore();

  const ungroupedTasks = tasks
    .filter((t) => t.parallelGroup === null)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  
  const handleCreateTask = () => {
    const newTask: Task = {
      id: `task-${Date.now()}`,
      title: 'New Task',
      agentRoleDescription: '',
      recommendedModel: 'gpt-4.1',
      prompt: '',
      successCriteria: [],
      dependencies: [],
      estimatedDuration: '30 minutes',
      estimatedToolCalls: 20,
      parallelGroup: null,
      qcAgentRoleDescription: '',
      verificationCriteria: [],
      maxRetries: 3,
    };
    addTask(newTask);
  };
  
  // Drop zone for agents (to create tasks) and tasks (to ungroup them)
  const [{ isOverAgent, isOverTask }, drop] = useDrop(() => ({
    accept: ['agent', 'task'],
    drop: (item: AgentTemplate | Task, monitor) => {
      // Only handle drop if it's directly on this zone (not a child zone)
      if (monitor.didDrop()) {
        return; // Already handled by a nested drop zone
      }
      
      const itemType = monitor.getItemType();
      
      if (itemType === 'agent') {
        // Agent dropped - create new task
        const agent = item as AgentTemplate;
        const newTask: Task = {
          id: `task-${Date.now()}`,
          title: `New ${agent.name} Task`,
          agentRoleDescription: agent.agentType === 'worker' ? agent.role : '',
          workerPreambleId: agent.agentType === 'worker' ? agent.id : undefined,
          recommendedModel: 'gpt-4.1',
          prompt: '',
          successCriteria: [],
          dependencies: [],
          estimatedDuration: '30 minutes',
          estimatedToolCalls: 20,
          parallelGroup: null,
          qcAgentRoleDescription: agent.agentType === 'qc' ? agent.role : '',
          qcPreambleId: agent.agentType === 'qc' ? agent.id : undefined,
          verificationCriteria: [],
          maxRetries: 3,
        };
        addTask(newTask);
      } else if (itemType === 'task') {
        // Task dropped - ungroup it (move to canvas)
        const task = item as Task;
        if (task.parallelGroup !== null) {
          assignTaskToGroup(task.id, null);
        }
      }
    },
    collect: (monitor) => ({
      isOverAgent: monitor.isOver({ shallow: true }) && monitor.getItemType() === 'agent',
      isOverTask: monitor.isOver({ shallow: true }) && monitor.getItemType() === 'task',
    }),
  }));

  return (
    <div 
      ref={drop}
      className={`p-6 space-y-6 min-h-full transition-colors ${
        isOverAgent || isOverTask ? 'bg-norse-stone' : 'bg-norse-night'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-valhalla-gold">Task Canvas</h2>
          <p className="text-sm text-gray-400 mt-1">
            Organize tasks into parallel execution groups
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={handleCreateTask}
            className="px-4 py-2 bg-valhalla-gold text-norse-night rounded-lg hover:bg-valhalla-amber flex items-center space-x-2 transition-all font-semibold shadow-lg hover:shadow-valhalla-gold/30"
          >
            <ListPlus className="w-5 h-5" />
            <span>Create Task</span>
          </button>
          <button
            type="button"
            onClick={addParallelGroup}
            className="px-4 py-2 bg-norse-stone border-2 border-norse-rune text-gray-100 rounded-lg hover:bg-norse-rune hover:border-valhalla-gold flex items-center space-x-2 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Add Parallel Group</span>
          </button>
        </div>
      </div>

      {/* Parallel Groups */}
      {parallelGroups.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-valhalla-gold uppercase tracking-wide">Parallel Execution Groups</h3>
          {parallelGroups.map((group) => (
            <ParallelGroupContainer key={group.id} group={group} />
          ))}
        </div>
      )}

      {/* Ungrouped Tasks */}
      {ungroupedTasks.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-valhalla-gold uppercase tracking-wide">
            Ungrouped Tasks
            <span className="ml-2 text-xs text-gray-400 normal-case font-normal">
              (drag to reorder or drag to groups • top-to-bottom execution order)
            </span>
          </h3>
          <div className="space-y-3">
            {ungroupedTasks.map((task, index) => (
              <ReorderableTaskCard 
                key={task.id} 
                task={task} 
                index={index}
                onReorder={reorderTask}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {ungroupedTasks.length === 0 && parallelGroups.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <div className="text-6xl mb-4">🎯</div>
          <h3 className="text-2xl font-bold mb-3 text-gray-200">No tasks yet</h3>
          <p className="text-center max-w-md text-base leading-relaxed mb-6">
            Click "Create Task" to add a new task, then drag worker and QC agents from the left 
            sidebar into the task card. Or use the PM Agent to generate a complete task plan.
          </p>
          <button
            type="button"
            onClick={handleCreateTask}
            className="px-6 py-3 bg-valhalla-gold text-norse-night rounded-lg hover:bg-valhalla-amber flex items-center space-x-2 transition-all font-semibold shadow-lg hover:shadow-valhalla-gold/30"
          >
            <ListPlus className="w-5 h-5" />
            <span>Create Your First Task</span>
          </button>
        </div>
      )}
    </div>
  );
}
