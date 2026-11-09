// The constructor taken out by destructuring, in a declaration and in an assignment.
const { constructor: F } = () => 0;
const { constructor } = async () => 0;
let G: unknown;
({ constructor: G } = function* () {});
export { F, G, constructor };
