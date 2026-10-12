import pkg from '@/package.json';

export const APP_VERSION: string = pkg.version;

export interface AppCredits {
  author: string;
  contributors: readonly string[];
}

export const APP_CREDITS: AppCredits = {
  author: '牢凌',
  contributors: ['11MOMO', 'Penna Mch'],
};
