const parser = require('@babel/parser');
const code = `
window.Pages = {
  render(container) {
    /**
     * Does something.
     */
    function foo() {
      return 1;
    }
  }
};
`;
const ast = parser.parse(code, { sourceType: 'module' });
const method = ast.program.body[0].expression.right.properties[0];
const blockStmt = method.value.body;
const funcDecl = blockStmt.body[0];

console.log('FunctionDeclaration leadingComments:', funcDecl.leadingComments);
if (funcDecl.leadingComments) {
  funcDecl.leadingComments.forEach(c => {
    console.log('value starts with *:', c.value.startsWith('*'));
  });
}
