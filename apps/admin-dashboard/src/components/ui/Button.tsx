import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export const Button = ({ 
  variant = 'primary', 
  size = 'md', 
  children, 
  className = '', 
  ...props 
}: ButtonProps) => {
  const baseStyles = 'inline-flex items-center justify-center font-medium transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:pointer-events-none';
  
  const variants = {
    primary: 'premium-gradient text-white shadow-lg shadow-primary-500/20 hover:shadow-primary-500/40',
    secondary: 'bg-slate-800 text-white hover:bg-slate-700',
    outline: 'border border-white/10 bg-transparent text-white hover:bg-white/5',
    ghost: 'bg-transparent text-slate-400 hover:text-white hover:bg-white/5'
  };
  
  const sizes = {
    sm: 'px-4 py-1.5 text-sm rounded-lg',
    md: 'px-6 py-2.5 text-base rounded-xl',
    lg: 'px-8 py-3.5 text-lg rounded-2xl'
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
