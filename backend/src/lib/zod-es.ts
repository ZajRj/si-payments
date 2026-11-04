import { z } from 'zod';

// Mensajes de validación en español. Los mensajes que define cada esquema tienen prioridad;
// lo que no se cubre aquí usa la traducción incluida en Zod.

const TYPE_NAMES: Record<string, string> = {
  string: 'un texto',
  number: 'un número',
  int: 'un número entero',
  boolean: 'verdadero o falso',
  object: 'un objeto',
  array: 'una lista',
};

z.config({
  localeError: z.locales.es().localeError,
  customError: (issue) => {
    switch (issue.code) {
      case 'invalid_type':
        if (issue.input === undefined || issue.input === null) return 'Este campo es obligatorio';
        return `Debe ser ${TYPE_NAMES[issue.expected] ?? 'un valor válido'}`;
      case 'too_small':
        if (issue.origin === 'string') {
          return Number(issue.minimum) <= 1 ? 'Este campo es obligatorio' : `Debe tener al menos ${issue.minimum} caracteres`;
        }
        if (issue.origin === 'number') return `Debe ser mayor ${issue.inclusive ? 'o igual ' : ''}que ${issue.minimum}`;
        return undefined;
      case 'too_big':
        if (issue.origin === 'string') return `Debe tener como máximo ${issue.maximum} caracteres`;
        if (issue.origin === 'number') return `Debe ser menor ${issue.inclusive ? 'o igual ' : ''}que ${issue.maximum}`;
        return undefined;
      case 'invalid_format':
        return issue.format === 'email' ? 'Email inválido' : 'Formato inválido';
      case 'invalid_value':
        return 'Valor no permitido';
      case 'unrecognized_keys':
        return undefined;
      default:
        return undefined;
    }
  },
});
