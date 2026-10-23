// As duas fontes podem ter ordens físicas diferentes após migrações legadas.
export const DRIVER_REGISTRY_SOURCE_COLUMNS = ["id", "display_name", "normalized_name", "cnpj", "cnpj_digits", "cpf", "cpf_digits", "email", "phone", "driver_type", "signup_policy", "active", "source_count", "created_at", "updated_at", "base", "data_nascimento", "rg", "sexo", "placa", "nome_favorecido", "cpf_favorecido", "cpf_favorecido_digits", "email_favorecido", "telefone_favorecido", "validade_gr"] as const;

export function driverRegistrySourceProjection(alias: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid SQL alias");
  return DRIVER_REGISTRY_SOURCE_COLUMNS.map(column => `${alias}."${column}"`).join(", ");
}
