export function sortRoutes(rotas: any[]) {
  const interior = ['vianópolis', 'abadiânia'];

  return rotas.sort((a, b) => {
    const aInterior = interior.includes(a.cidade?.toLowerCase());
    const bInterior = interior.includes(b.cidade?.toLowerCase());

    if (aInterior && !bInterior) return -1;
    if (!aInterior && bInterior) return 1;
    return 0;
  });
}