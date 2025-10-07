const vscode = require('vscode');
const ucid = require('unique-custom-id');

function activate(context) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'taskline.todoEditor',
      new TodoEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );
}

class TodoEditorProvider {
  constructor(context) {
    this.context = context;
  }

  // Generate UUID
  generateUUID() {
    return ucid.format('uuid');
  }

  async resolveCustomTextEditor(document, webviewPanel, _token) {
    webviewPanel.webview.options = { enableScripts: true };

    const updateWebview = () => {
      let tasks = [];
      try {
        const content = document.getText();
        if (content.trim()) {
          tasks = JSON.parse(content);
          // Migration: convert old string format to new object format
          tasks = tasks.map((task) => {
            if (typeof task === 'string') {
              return {
                id: this.generateUUID(),
                text: task,
                completed: false,
                createdAt: new Date().toISOString(),
                priority: 'medium',
              };
            }
            return task;
          });
        }
      } catch (e) {
        tasks = [];
      }
      webviewPanel.webview.html = this.getHtml(tasks);
    };

    updateWebview();

    // Handle document changes from external edits
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          updateWebview();
        }
      }
    );

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      let tasks = [];
      try {
        const content = document.getText();
        if (content.trim()) {
          tasks = JSON.parse(content);
        }
      } catch (e) {
        tasks = [];
      }

      switch (message.command) {
        case 'addTask':
          const newTask = {
            id: this.generateUUID(),
            text: message.text,
            completed: false,
            createdAt: new Date().toISOString(),
            priority: message.priority || 'medium',
          };
          tasks.push(newTask);
          break;

        case 'toggleTask':
          const taskIndex = tasks.findIndex((task) => task.id === message.id);
          if (taskIndex !== -1) {
            tasks[taskIndex].completed = !tasks[taskIndex].completed;
          }
          break;

        case 'deleteTask':
          tasks = tasks.filter((task) => task.id !== message.id);
          break;

        case 'updateTask':
          const updateIndex = tasks.findIndex((task) => task.id === message.id);
          if (updateIndex !== -1) {
            tasks[updateIndex] = { ...tasks[updateIndex], ...message.updates };
          }
          break;

        case 'updatePriority':
          const priorityIndex = tasks.findIndex(
            (task) => task.id === message.id
          );
          if (priorityIndex !== -1) {
            tasks[priorityIndex].priority = message.priority;
          }
          break;
      }

      // Save the updated tasks
      const edit = new vscode.WorkspaceEdit();
      const newText = JSON.stringify(tasks, null, 2);
      const fullRange = new vscode.Range(0, 0, document.lineCount, 0);
      edit.replace(document.uri, fullRange, newText);
      await vscode.workspace.applyEdit(edit);
      await document.save();
      updateWebview();
    });
  }

  getHtml(tasks) {
    const completedTasks = tasks.filter((task) => task.completed);
    const pendingTasks = tasks.filter((task) => !task.completed);

    const renderTask = (task) => {
      const createdDate = new Date(task.createdAt).toLocaleDateString();
      const createdTime = new Date(task.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      const priorityColors = {
        high: '#ef4444',
        medium: '#e0d316',
        low: '#10b981',
      };

      return `
        <div class="task-item ${task.completed ? 'completed' : ''}" data-id="${
        task.id
      }">
          <div class="task-content">
            <input type="checkbox" class="task-checkbox" ${
              task.completed ? 'checked' : ''
            } 
                   onchange="toggleTask('${task.id}')">
            <span class="task-text ${task.completed ? 'strikethrough' : ''}" 
                  contenteditable="true" onblur="updateTaskText('${
                    task.id
                  }', this.textContent)">${task.text}</span>
            <div class="task-meta">
              <span class="created-at">${createdDate} ${createdTime}</span>
              <div class="priority-indicator" style="background-color: ${
                priorityColors[task.priority]
              }" title="${task.priority} priority"></div>
            </div>
            <div class="task-actions">
              <select class="priority-select" onchange="updatePriority('${
                task.id
              }', this.value)">
                <option value="high" ${
                  task.priority === 'high' ? 'selected' : ''
                }>High</option>
                <option value="medium" ${
                  task.priority === 'medium' ? 'selected' : ''
                }>Medium</option>
                <option value="low" ${
                  task.priority === 'low' ? 'selected' : ''
                }>Low</option>
              </select>
              <button class="delete-btn" onclick="deleteTask('${
                task.id
              }')" title="Delete task">×</button>
            </div>
          </div>
        </div>
      `;
    };

    const pendingTasksHtml = pendingTasks.map(renderTask).join('');
    const completedTasksHtml = completedTasks.map(renderTask).join('');

    return `
      <!DOCTYPE html>
			<html lang="en">
  	<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
          sans-serif;
        padding: 16px 25%;
        min-width: 600px;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        line-height: 1.4;
        font-size: 13px;
      }

      .stats {
        display: flex;
        gap: 12px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .add-task-section {
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        padding: 12px;
        margin-bottom: 16px;
      }

      .add-task-form {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .task-input {
        flex: 1;
        padding: 6px 8px;
        border: 1px solid var(--vscode-input-border);
        border-radius: 3px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        font-size: 13px;
      }

      .task-input:focus {
        outline: none;
      }

      .priority-select {
        padding: 6px 8px;
        border: 1px solid var(--vscode-input-border);
        border-radius: 3px;
        background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        font-size: 11px;
        cursor: pointer;
      }

      .add-btn {
        padding: 6px 12px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 500;
      }

      .add-btn:hover {
        background: var(--vscode-button-hoverBackground);
      }

      .tasks-section {
        margin-bottom: 16px;
      }

      .section-title {
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 8px;
        color: var(--vscode-titleBar-activeForeground);
        cursor: pointer;
        user-select: none;
      }

      .section-title:hover {
        opacity: 0.8;
      }

      .task-item {
        background: var(--vscode-list-inactiveSelectionBackground);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 3px;
        margin-bottom: 4px;
        transition: all 0.15s ease;
        border: 1px solid transparent;
      }

      .task-item:has(.task-text:focus) {
        border-color: var(--vscode-focusBorder);
      }

      .task-item:hover {
        border-color: var(--vscode-list-hoverBackground);
      }

      .task-item.completed {
        opacity: 0.6;
      }

      .task-content {
        display: flex;
        align-items: center;
        padding: 8px 10px;
        gap: 8px;
      }

      .task-checkbox {
        cursor: pointer;
        margin: 0;
      }

      .task-text {
        flex: 1;
        font-size: 13px;
        padding: 2px 4px;
        border-radius: 2px;
        cursor: text;
        min-height: 16px;
      }

      .task-text:focus {
        outline: none;
      }

      .strikethrough {
        text-decoration: line-through;
        opacity: 0.7;
      }

      .task-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
      }

      .created-at {
        white-space: nowrap;
      }

      .priority-indicator {
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }

      .task-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .delete-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 2px;
        font-size: 14px;
        color: var(--vscode-descriptionForeground);
        font-weight: bold;
      }

      .delete-btn:hover {
        background: var(--vscode-list-errorForeground);
        color: white;
      }

      .empty-state {
        text-align: center;
        padding: 24px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <div class="add-task-section">
      <div class="add-task-form">
        <input
          type="text"
          id="newTaskInput"
          class="task-input"
          placeholder="Add a task..."
          autofocus
        />
        <select id="prioritySelect" class="priority-select">
          <option value="high">High</option>
          <option value="medium" selected>Medium</option>
          <option value="low">Low</option>
        </select>
        <button id="addTaskBtn" class="add-btn">Add</button>
      </div>
    </div>

    ${ pendingTasks.length > 0 ? `
    <div class="tasks-section">
      <h3 class="section-title" onclick="toggleSection('pending')">
        <span id="pending-icon">▼</span>&puncsp;&puncsp;&puncsp;&puncsp;Pending
        (${pendingTasks.length})
      </h3>
      <div id="pending-tasks">${pendingTasksHtml}</div>
    </div>
    ` : '' } ${ completedTasks.length > 0 ? `
    <div class="tasks-section">
      <h3 class="section-title" onclick="toggleSection('completed')">
        <span id="completed-icon">▼</span>&puncsp;&puncsp;&puncsp;&puncsp;Completed
        (${completedTasks.length})
      </h3>
      <div id="completed-tasks">${completedTasksHtml}</div>
    </div>
    ` : '' } ${ tasks.length === 0 ? `
    <div class="empty-state">No tasks yet. Add one above to get started!</div>
    ` : '' }

    <script>
      const vscode = acquireVsCodeApi();
      let collapsedSections = new Set();

      function addTask() {
        const taskInput = document.getElementById('newTaskInput');
        const prioritySelect = document.getElementById('prioritySelect');

        const text = taskInput.value.trim();
        if (!text) return;

        vscode.postMessage({
          command: 'addTask',
          text: text,
          priority: prioritySelect.value,
        });

        taskInput.value = '';
        prioritySelect.value = 'medium';
        taskInput.focus();
      }

      function toggleTask(id) {
        vscode.postMessage({
          command: 'toggleTask',
          id: id,
        });
      }

      function deleteTask(id) {
				vscode.postMessage({
					command: 'deleteTask',
					id: id,
				});
      }

      function updateTaskText(id, text) {
        if (text.trim()) {
          vscode.postMessage({
            command: 'updateTask',
            id: id,
            updates: { text: text.trim() },
          });
        }
      }

      function updatePriority(id, priority) {
        vscode.postMessage({
          command: 'updatePriority',
          id: id,
          priority: priority,
        });
      }

      function toggleSection(section) {
        const element = document.getElementById(section + '-tasks');
        const icon = document.getElementById(section + '-icon');

        if (collapsedSections.has(section)) {
          element.style.display = 'block';
          collapsedSections.delete(section);
          icon.textContent = '▼';
        } else {
          element.style.display = 'none';
          collapsedSections.add(section);
          icon.textContent = '▶';
        }
      }

      // Event listeners
      document.getElementById('addTaskBtn').addEventListener('click', addTask);

      document
        .getElementById('newTaskInput')
        .addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            addTask();
          }
        });

      // Prevent empty task text
      document.addEventListener(
        'blur',
        (e) => {
          if (e.target.classList.contains('task-text')) {
            if (e.target.textContent.trim() === '') {
              e.target.textContent = 'Untitled Task';
              updateTaskText(
                e.target.closest('.task-item').dataset.id,
                'Untitled Task'
              );
            }
          }
        },
        true
      );

      // Prevent line breaks in task text
      document.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('task-text') && e.key === 'Enter') {
          e.preventDefault();
          e.target.blur();
        }
      });
    </script>
  </body>
</html>

    `;
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
