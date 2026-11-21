import { spawn } from 'child_process';
import { getBundledExecutablePath } from '../dependencies.js';
import { logger } from './logger.js';
import { spawnYtDlp } from './local-data.js';

// Task management for long-running processes (yt-dlp or ffmpeg)
class TaskManager {
    constructor() {
        this.currentTask = null;
    }

    hasActiveTask() {
        return this.currentTask !== null && !this.currentTask.isDone;
    }

    startTask(type, description = '') {
        if (this.hasActiveTask()) {
            throw new Error('Another task is already running. Please await completion or cancel it.');
        }
        const task = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type,
            description,
            isCancelled: false,
            isDone: false,
            activeProcess: null
        };
        this.currentTask = task;
        return task;
    }

    spawnProcess(task, command, args, options = {}) {
        if (task.isCancelled) {
            throw new Error('Action cancelled by user.');
        }

        // yt-dlp can run FFmpeg as a child while downloading a section.
        const spawnOptions = { detached: process.platform !== 'win32' && command === 'yt-dlp', ...options };
        const executable = getBundledExecutablePath(command) || command;
        const child = command === 'yt-dlp' ? spawnYtDlp(executable, args, spawnOptions) : spawn(executable, args, spawnOptions);
        task.activeProcess = child;
        task.activeProcessGroup = spawnOptions.detached;

        child.on('error', (err) => {
            logger.error(`Process error [${command}]:`, err);
        });

        child.on('close', () => {
            if (task.activeProcess === child) {
                task.activeProcess = null;
            }
        });

        return child;
    }

    cancelCurrentTask() {
        if (!this.hasActiveTask()) {
            return false;
        }

        const task = this.currentTask;
        task.isCancelled = true;

        if (task.activeProcess) {
            const pid = task.activeProcess.pid;
            logger.info(`Cancelling task [${task.type}] with process PID: ${pid}`);

            try {
                if (process.platform === 'win32') {
                    spawn('taskkill', ['/pid', pid.toString(), '/T', '/F']);
                } else if (task.activeProcessGroup && pid) {
                    process.kill(-pid, 'SIGKILL');
                } else {
                    task.activeProcess.kill('SIGKILL');
                }
            } catch (e) {
                logger.error('Error killing process:', e);
            }
        }

        return true;
    }

    endTask(task) {
        if (task) {
            task.isDone = true;
            if (task.activeProcess) {
                try {
                    task.activeProcess.kill('SIGKILL');
                } catch { /* ignore */ }
                task.activeProcess = null;
            }
            if (this.currentTask === task) {
                this.currentTask = null;
            }
        }
    }
}

const taskManager = new TaskManager();

export { taskManager };
