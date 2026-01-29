import { createTheme } from '@mui/material/styles';

// 視認性と「業務っぽさ」を両立したダークテーマ
export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#4dd0e1', // cyan系
    },
    secondary: {
      main: '#f48fb1', // pink系
    },
    background: {
      default: '#0b0f14',
      paper: '#111827',
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontSize: 14,
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    button: { textTransform: 'none', fontWeight: 700 },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          border: '1px solid rgba(255,255,255,0.06)',
        },
      },
    },
    MuiButton: {
      defaultProps: {
        variant: 'contained',
      },
    },
  },
});
