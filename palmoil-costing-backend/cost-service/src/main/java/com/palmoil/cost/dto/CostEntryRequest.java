package com.palmoil.cost.dto;

public class CostEntryRequest {
    private String batchId;
    private String category;
    private Double amount;
    private String description;

    public String getBatchId() { return batchId; }
    public String getCategory() { return category; }
    public Double getAmount() { return amount; }
    public String getDescription() { return description; }

    public void setBatchId(String batchId) { this.batchId = batchId; }
    public void setCategory(String category) { this.category = category; }
    public void setAmount(Double amount) { this.amount = amount; }
    public void setDescription(String description) { this.description = description; }
}
