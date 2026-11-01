/** @type {import('tailwindcss').Config} */
const c = (name) => `rgb(var(--${name}) / <alpha-value>)`

module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'media',
  theme: {
    // 间距直接是 dp：p-4 = 16dp，不经过 rem（NativeWind 的 rem 是 14px）。
    spacing: {
      0: '0px',
      px: '1px',
      0.5: '2px',
      1: '4px',
      2: '8px',
      3: '12px',
      4: '16px',
      5: '20px',
      6: '24px',
      7: '28px',
      8: '32px',
      10: '40px',
      12: '48px',
      14: '56px',
      16: '64px',
      20: '80px',
      24: '96px',
    },
    borderRadius: {
      none: '0px',
      sm: '8px',
      md: '14px',
      lg: '20px',
      full: '999px',
    },
    extend: {
      colors: {
        canvas: c('canvas'),
        surface: c('surface'),
        sunken: c('sunken'),
        line: c('line'),
        'line-strong': c('line-strong'),
        ink: c('ink'),
        muted: c('muted'),
        faint: c('faint'),
        accent: c('accent'),
        'accent-quiet': c('accent-quiet'),
        danger: c('danger'),
        warn: c('warn'),
        ok: c('ok'),
      },
      // 五档字阶。中文大字需要负字距才紧实，正文一律 0，label 唯一带正字距。
      fontSize: {
        display: ['28px', { lineHeight: '36px', letterSpacing: '-0.5px' }],
        title: ['20px', { lineHeight: '28px', letterSpacing: '-0.2px' }],
        heading: ['16px', { lineHeight: '24px', letterSpacing: '-0.1px' }],
        body: ['16px', { lineHeight: '25px', letterSpacing: '0px' }],
        'body-sm': ['14px', { lineHeight: '22px', letterSpacing: '0px' }],
        caption: ['12px', { lineHeight: '18px', letterSpacing: '0px' }],
        label: ['13px', { lineHeight: '18px', letterSpacing: '0.3px' }],
        mono: ['12px', { lineHeight: '18px', letterSpacing: '0px' }],
      },
    },
  },
  plugins: [],
}
