export interface ExampleBoard {
  label: string;
  path: string;
}

export const EXAMPLE_BOARDS: ExampleBoard[] = [
  { label: 'SimX overview (default)', path: 'sample-document.json' },
  { label: 'Pokemon Red gameplay features', path: 'examples/pokemon-red.json' },
  { label: 'Medium (~36 items)', path: 'examples/medium.json' },
  { label: 'Extra large (~136 items)', path: 'examples/xlarge.json' },
];
