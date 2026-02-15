// Type declarations for write-file-atomic v7
// This package ships CJS but is importable from ESM in Node 20+

declare module 'write-file-atomic' {
  interface WriteOptions {
    chown?: { uid: number; gid: number };
    encoding?: BufferEncoding;
    fsync?: boolean;
    mode?: number;
    tmpfileCreated?: (tmpfile: string) => void | Promise<void>;
  }

  function writeFileAtomic(
    filename: string,
    data: string | Buffer,
    options?: WriteOptions | BufferEncoding,
  ): Promise<void>;

  export default writeFileAtomic;
}
