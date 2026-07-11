FROM maven:3.9.8-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/target/cost-service-1.0.0.jar app.jar
ADD https://dtdg.co/latest-java-tracer /dd-java-agent.jar
CMD ["java", "-javaagent:/dd-java-agent.jar", "-jar", "app.jar"]
