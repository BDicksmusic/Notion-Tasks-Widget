export type MatrixOptionId =
  | 'do-now'
  | 'deep-work'
  | 'delegate'
  | 'trash';

export interface MatrixOption {
  id: MatrixOptionId;
  label: string;
  urgent: boolean;
  important: boolean;
}

export const matrixOptions: MatrixOption[] = [
  { id: 'do-now', label: 'Do Now', urgent: true, important: true },
  { id: 'deep-work', label: 'Deep Work', urgent: false, important: true },
  { id: 'delegate', label: 'Delegate', urgent: true, important: false },
  { id: 'trash', label: 'Trash', urgent: false, important: false }
];

export const getMatrixLabel = (urgent: boolean, important: boolean) => {
  if (urgent && important) return 'Do Now';
  if (important) return 'Deep Work';
  if (urgent) return 'Delegate';
  return 'Trash';
};

export const getMatrixClass = (urgent: boolean, important: boolean) => {
  if (urgent && important) return 'matrix-green';
  if (important) return 'matrix-blue';
  if (urgent) return 'matrix-yellow';
  return 'matrix-orange';
};

export const findMatrixOptionById = (id: MatrixOptionId) =>
  matrixOptions.find((option) => option.id === id);

export const findMatrixOptionFromFlags = (urgent?: boolean, important?: boolean) =>
  matrixOptions.find(
    (option) =>
      Boolean(option.urgent) === Boolean(urgent) &&
      Boolean(option.important) === Boolean(important)
  ) ?? matrixOptions[matrixOptions.length - 1];



