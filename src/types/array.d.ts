declare global {
  interface Array<T> {
    sample(n?: number): Array<T>;
    shuffle(): Array<T>;
  }
}
