import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg:       '#000000',
        surface:  '#0d0d0d',
        surface2: '#141414',
        accent:   '#c8f03a',
        muted:    '#606060',
        muted2:   '#383838',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
