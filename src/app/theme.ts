import { type CSSVariablesResolver, type MantineColorsTuple, createTheme } from '@mantine/core'

// "Plc zine" from the website, made for a back office: paper and ink, flyer green
// as the one highlight, square corners and hard rules. The typewriter face is for
// headings only; data stays in the system font so it reads at a glance.

const flyer: MantineColorsTuple = [
  '#f4fbec', '#e7f6d7', '#d0edb0', '#b8e487', '#a6e36f',
  '#8fcf55', '#74b33f', '#5a9230', '#407222', '#2c6410'
]

// Ink to paper, darkest last, as Mantine expects for the dark scheme.
const ink: MantineColorsTuple = [
  '#ece8dd', '#c9c4b6', '#a7a295', '#7a766b', '#4f4b43',
  '#3a3832', '#24231f', '#1b1a17', '#131210', '#0c0c0b'
]

export const theme = createTheme({
  primaryColor: 'flyer',
  primaryShade: 4,
  autoContrast: true,
  colors: { flyer, dark: ink },
  black: '#0c0c0b',
  defaultRadius: 0,
  cursorType: 'pointer',
  headings: { fontFamily: '"Special Elite", ui-monospace, monospace', fontWeight: '400' },
  components: {
    // Paper with a hard ink rule, not a white floating card.
    Card: {
      defaultProps: { withBorder: true, radius: 0 },
      styles: { root: { backgroundColor: 'var(--mantine-color-body)', borderColor: 'var(--mantine-color-default-border)' } }
    },
    Paper: {
      defaultProps: { withBorder: true, radius: 0 },
      styles: { root: { backgroundColor: 'var(--mantine-color-body)', borderColor: 'var(--mantine-color-default-border)' } }
    },
    Badge: { defaultProps: { radius: 0 } },
    Chip: { defaultProps: { radius: 0 } }
  }
})

// Flyer green is too light for text on paper: links and "light" accents use the
// website's dark green there.
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    '--mantine-color-body': '#f2efe6',
    '--mantine-color-anchor': '#2c6410',
    '--mantine-primary-color-light-color': '#2c6410',
    '--mantine-color-default-border': '#0c0c0b'
  },
  dark: {
    '--mantine-color-body': '#0c0c0b',
    '--mantine-color-default-border': '#4f4b43'
  }
})
