import { api, loadList } from '../api.js';
export const STAGES = ['构想', '组队', '制作', '验证', '发布'];
export const loadProjects = options => loadList('/orgs/hub/projects', undefined, options);
export const joinProject = slug => api.post(`/orgs/${encodeURIComponent(slug)}/join`);
