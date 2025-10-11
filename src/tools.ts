/**
* In-memory inventory (pretend this is a database)
*/
const products = [
  { id: "1", name: "Laptop", price: 999, stock: 5 },
  { id: "2", name: "Mouse", price: 29, stock: 50 },
  { id: "3", name: "Keyboard", price: 79, stock: 25 }
];

export async function getInventory() {
  console.error("[Tool] getInventory called");
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(products, null, 2) }
    ]
  };
}

export async function checkStock(productId: string) {
  console.error(`[Tool] checkStock called for product: ${productId}`);

  const product = products.find((p) => p.id === productId);
  if (!product) {
    throw new Error(`Product ${productId} not found`);
  }

  return {
    content: [
      { type: "text" as const, text: `${product.name}: ${product.stock} units in stock` }
    ]
  };
}
