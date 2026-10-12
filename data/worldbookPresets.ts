import type { 世界书 } from '@/models/worldbook';
import { createBuiltinConfigWorldbooks } from './builtinWorldbookConfig';
import { createStoryModeWorldbooks } from './storyModeWorldbooks';

export function createBuiltinWorldbooks(): 世界书[] {
  return [...createBuiltinConfigWorldbooks(), ...createStoryModeWorldbooks()];
}
