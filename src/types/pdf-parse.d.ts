declare module 'pdf-parse' {
  function parse(dataBuffer: Buffer): Promise<{ text: string }>;
  export = parse;
} 