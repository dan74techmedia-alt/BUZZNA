import React, { createContext, useContext, useEffect, useState } from 'react';

// Map the exact documentation hex codes to standard application tokens
const themes = {
  'Savannah Premium': {
    primary: '#C85A32',      // Burnt Sienna [cite: 152]
    secondary: '#F8B735',    // Amber Haze [cite: 153]
    background: '#FDFBF7',   // White Onyx [cite: 154]
    surface: '#F5EFE6',      // Sand Stone [cite: 154]
    text: '#2D1E18'          // Cocoa Dark [cite: 155]
  },
  'Delta Digital': {
    primary: '#1A5F60',      // Transformative Teal [cite: 159]
    secondary: '#E60067',    // Electric Fuchsia [cite: 160]
    background: '#F4F6F6',   // Clean Slate [cite: 161]
    surface: '#EAEFF0',      // Ice Blue [cite: 161]
    text: '#0F172A'          // Ink Midnight [cite: 162]
  },
  'Royal Heritage': {
    primary: '#4A1525',      // Deep Damson Plum [cite: 166]
    secondary: '#D4AF37',    // Heritage Gold [cite: 167]
    background: '#FAF5EF',   // Soft Almond [cite: 168]
    surface: '#EFE6DC',      // Muted Clay [cite: 168]
    text: '#1C1917'          // Charcoal Espresso [cite: 169]
  },
  'Forest Oasis': {
    primary: '#0A3622',      // Phthalo Forest [cite: 173]
    secondary: '#F38218',    // Radiant Guava [cite: 174]
    background: '#F2F4F3',   // Minimal Sage [cite: 175]
    surface: '#E4E8E6',      // Pale Moss [cite: 175]
    text: '#0B1A12'          // Obsidian Green [cite: 176]
  }
};

type ThemeName = keyof typeof themes;

interface ThemeContextType {
  activeTheme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Default to Savannah Premium as per business settings default [cite: 219]
  const [activeTheme, setActiveTheme] = useState<ThemeName>('Savannah Premium');

  useEffect(() => {
    const root = document.documentElement;
    const currentTheme = themes[activeTheme];

    // Inject CSS variables to the root document, enabling instant global UI updates [cite: 178, 180]
    root.style.setProperty('--color-primary', currentTheme.primary);
    root.style.setProperty('--color-secondary', currentTheme.secondary);
    root.style.setProperty('--color-background', currentTheme.background);
    root.style.setProperty('--color-surface', currentTheme.surface);
    root.style.setProperty('--color-text', currentTheme.text);
    
    // Set a data attribute for any complex CSS targeting [cite: 178]
    root.setAttribute('data-theme', activeTheme.toLowerCase().replace(' ', '-'));
  }, [activeTheme]);

  return (
    <ThemeContext.Provider value={{ activeTheme, setTheme: setActiveTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};